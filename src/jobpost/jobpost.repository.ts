import { DataSource, Repository } from 'typeorm'
import { Jobpost } from 'src/entities/jobpost.entity'
import { Injectable } from '@nestjs/common'
import { CompanyRepository } from 'src/company/company.repository'
import { default as keywords } from '../resources/data/parsing/keywordsForParsing.json'
import { default as stacks } from '../resources/data/parsing/stacksForParsing.json'
import { InjectRepository } from '@nestjs/typeorm'
import { Keyword } from 'src/entities/keyword.entity'
import { Stack } from 'src/entities/stack.entity'
import { CacheService } from 'src/cache/cache.service'

@Injectable()
export class JobpostRepository extends Repository<Jobpost> {
    constructor(
        private dataSource: DataSource,
        private companyRepository: CompanyRepository,
        @InjectRepository(Keyword)
        private keywordRepository: Repository<Keyword>,
        private cacheService: CacheService,
        @InjectRepository(Stack) private stackRepository: Repository<Stack>
    ) {
        super(Jobpost, dataSource.createEntityManager())
    }

    async createJobposts(jobposts) {
        // 공고 데이터 한번씩 돌면서
        for (let jobpost of jobposts) {
            const {
                companyName,
                title,
                content,
                salary,
                originalSiteName,
                originalUrl,
                originalImgUrl,
                postedDtm,
                deadlineDtm,
                originalAddress,
                addressUpper,
                addressLower,
                longitude,
                latitude,
            } = jobpost

            // 회사 id 들고오는 쿼리
            const companyId = await this.companyRepository.findCompanyId(
                companyName
            )

            const { keywords, stacks } = await this.keywordParser(
                title,
                content
            )

            const createdJobpost = await this.createQueryBuilder('jobpost')
                .insert()
                .into('jobpost')
                .values({
                    companyId,
                    title,
                    content,
                    salary,
                    originalSiteName,
                    originalUrl,
                    originalImgUrl,
                    postedDtm,
                    deadlineDtm,
                    originalAddress,
                    addressUpper,
                    addressLower,
                    longitude,
                    latitude,
                })
                .orUpdate(
                    ['salary', 'original_img_url', 'deadline_dtm'],
                    ['company_id', 'title']
                )
                .updateEntity(false)
                .execute()

            if (
                createdJobpost.raw.insertId !== 0 &&
                createdJobpost.raw.affectedRows === 1
            ) {
                await this.createQueryBuilder()
                    .relation(Jobpost, 'keywords')
                    .of({ jobpostId: createdJobpost.raw.insertId })
                    .add(keywords)

                await this.createQueryBuilder()
                    .relation(Jobpost, 'stacks')
                    .of({ jobpostId: createdJobpost.raw.insertId })
                    .add(stacks)
            }
        }
    }

    async keywordParser(title: string, content: string | object) {
        const contentKeywords = []
        const contentStacks = []

        if (typeof content === 'object') content = JSON.stringify(content)
        content = title + ' ' + content

        for (let i = 0; i < keywords.length; i++) {
            if (keywords[i].excludes) {
                for (let k = 0; k < keywords[i].excludes.length; k++) {
                    content = content.replaceAll(keywords[i].excludes[k], '')
                }
            }

            for (let j = 0; j < keywords[i].keyword.length; j++) {
                const re = new RegExp(`${keywords[i].keyword[j]}`, 'gi')
                if (re.test(content)) {
                    const keyword = await this.keywordRepository.findOne({
                        where: { keywordCode: keywords[i].keywordCode },
                    })
                    contentKeywords.push(keyword)
                    break
                }
            }
        }

        for (let i = 0; i < stacks.length; i++) {
            for (let j = 0; j < stacks[i].stack.length; j++) {
                if (stacks[i].excludes) {
                    for (let k = 0; k < stacks[i].excludes.length; k++) {
                        content = content.replaceAll(stacks[i].excludes[k], '')
                    }
                }

                const regExVar = stacks[i].stack[j].replace(
                    /[.*+?^${}()|[\]\\]/g,
                    '\\$&'
                )
                const re = new RegExp(`\\b${regExVar}\\b`, 'gi')
                if (re.test(content)) {
                    const stack = await this.stackRepository.findOne({
                        where: { stack: stacks[i].stack[0] },
                    })
                    if (stack === null) console.warn(stacks[i])
                    contentStacks.push(stack)
                    break
                }
            }
        }

        return { keywords: contentKeywords, stacks: contentStacks }
    }

    async getFilteredJobposts(
        sort: string,
        order: string,
        limit: number,
        offset: number,
        others: object
    ) {
        if (sort === 'recommended') {
            let query = `SELECT j.jobpost_id,
                                j.title,
                                company_name,
                                COALESCE(0.4 * (1 - (distance - minDistance) / (maxDistance - minDistance)),0) as distanceScore,
                                COALESCE(0.5 * ((stackMatches - minStackMatches) / (maxStackMatches - minStackMatches)),0) as stackScore,
                                COALESCE(0.3 * ((keywordMatches - minKeywordMatches) / (maxKeywordMatches - minKeywordMatches)),0) as keywordScore,
                                COALESCE(0.1 * ((j.salary - minSalary) / (maxSalary - minSalary)),0) as salaryScore,
                                COALESCE(0.05 * ((avg_salary - minAvgSalary) / (maxAvgSalary - minAvgSalary)),0) as avgSalaryScore,
                                (COALESCE(0.4 * (1 - (distance - minDistance) / (maxDistance - minDistance)),0) +
                                COALESCE(0.5 * ((stackMatches - minStackMatches) / (maxStackMatches - minStackMatches)),0) +
                                COALESCE(0.3 * ((keywordMatches - minKeywordMatches) / (maxKeywordMatches - minKeywordMatches)),0) + 
                                COALESCE(0.1 * ((j.salary - minSalary) / (maxSalary - minSalary)),0) +
                                COALESCE(0.05 * (avg_salary - minAvgSalary) / (maxAvgSalary - minAvgSalary),0)) as score,
                                j.address_upper,
                                j.address_lower,
                                j.original_address,
                                j.salary,
                                j.original_img_url,
                                stacks,
                                stackimgurls,
                                keywords,
                                stackMatches,
                                j.salary,
                                COUNT(*) OVER () as totalCount
                        FROM jobpost j
                        JOIN (SELECT 
                                    jp.jobpost_id,
                                    title,
                                    (6371 * acos(cos(radians(u.latitude)) * cos(radians(jp.latitude)) * cos(radians(jp.longitude) - radians(u.longitude)) + sin(radians(u.latitude)) * sin(radians(jp.latitude)))) AS distance,
                                    us.user_id,
                                    u.longitude,
                                    u.latitude,
                                    GROUP_CONCAT(DISTINCT jps.stack_ids) AS jobpoststack,
                                    GROUP_CONCAT(us.stack_id) AS userstack,
                                    stacks,
                                    stackimgurls,
                                    COUNT(*) AS stackMatches,
                                    MIN(6371 * acos(cos(radians(u.latitude)) * cos(radians(jp.latitude)) * cos(radians(jp.longitude) - radians(u.longitude)) + sin(radians(u.latitude)) * sin(radians(jp.latitude)))) OVER () as minDistance,
                                    MAX(6371 * acos(cos(radians(u.latitude)) * cos(radians(jp.latitude)) * cos(radians(jp.longitude) - radians(u.longitude)) + sin(radians(u.latitude)) * sin(radians(jp.latitude)))) OVER () as maxDistance,
                                    MIN(COUNT(*)) OVER () AS minStackMatches,
                                    MAX(COUNT(*)) OVER () AS maxStackMatches,
                                    MIN(jp.salary) OVER () as minSalary,
                                    MAX(jp.salary) OVER () as maxSalary,
                                    c.avg_salary,
                                    MIN(c.avg_salary) OVER () as minAvgSalary,
                                    MAX(c.avg_salary) OVER () as maxAvgSalary,
                                    c.company_name
                                FROM 
                                    jobpost jp 
                                LEFT JOIN (
                                    SELECT 
                                        js.jobpost_id,
                                        GROUP_CONCAT(js.stack_id) AS stack_ids,
                                        GROUP_CONCAT(s.stack) AS stacks,
                                        GROUP_CONCAT(s.stack_img_url) AS stackImgUrls 
                                    FROM 
                                        jobpoststack js 
                                    LEFT JOIN 
                                        stack s ON js.stack_id = s.stack_id 
                                    GROUP BY 
                                        js.jobpost_id 
                                    ORDER BY 
                                        NULL
                                ) jps ON jp.jobpost_id = jps.jobpost_id 
                                INNER JOIN userstack us ON jps.stack_ids LIKE CONCAT('%,', us.stack_id, ',%') 
                                LEFT JOIN \`user\` u ON us.user_id = u.user_id 
                                JOIN company c ON jp.company_id = c.company_id 
                                WHERE 
                                    us.user_id = 1 
                                GROUP BY 
                                    jp.jobpost_id) distanceStacksCalculated ON j.jobpost_id = distanceStacksCalculated.jobpost_id
                        JOIN (SELECT j.jobpost_id, 
                                    group_concat(jk.keyword_code) AS jobpostKeyword, 
                                    group_concat(k.keyword_code) AS userKeyword,
                                    group_concat(ky.keyword) AS keywords,
                                    COUNT(*) AS keywordMatches,
                                    MIN(COUNT(*)) OVER () AS minKeywordMatches,
                                    MAX(COUNT(*)) OVER () AS maxKeywordMatches
                                FROM jobpost AS j
                                LEFT JOIN jobpostkeyword AS jk ON j.jobpost_id = jk.jobpost_id
                                LEFT JOIN (
                                    SELECT j.jobpost_id, keyword_code
                                    FROM likedjobpost
                                    JOIN jobpostkeyword j ON likedjobpost.jobpost_id = j.jobpost_id
                                    WHERE user_id = 1
                                    GROUP BY keyword_code
                                ) AS k ON jk.keyword_code = k.keyword_code
                                JOIN keyword ky ON k.keyword_code = ky.keyword_code
                                WHERE jk.keyword_code IS NOT NULL
                                GROUP BY j.jobpost_id
                                HAVING group_concat(jk.keyword_code) IN (group_concat(k.keyword_code))) keywordStats ON j.jobpost_id = keywordStats.jobpost_id
                        GROUP BY j.jobpost_id
                        ORDER BY score DESC
                        LIMIT ?`

            const values = [limit]
            const data = await this.query(query, values)

            const likedUser = await this.cacheService.getAllLikedjobpost()

            return {
                data,
                totalCount: data[0].totalCount,
                likedUser,
            }
        } else {
            let where = ''
            let having = ''
            switch (sort) {
                case 'recent':
                    sort = `j.updated_dtm ${order}`
                    break
                case 'popular':
                    sort = `likesCount ${order}, views ${order}`
                    break
                case 'ending':
                    if (order === 'asc') {
                        sort = `deadline_dtm ${order}`
                        where = 'where deadline_dtm is not null'
                        break
                    } else {
                        sort = `deadline_dtm ${order}`
                        break
                    }
                default:
                    sort = `j.updated_dtm ${order}`
            }

            if (others) {
                const othersKeys = Object.keys(others)
                for (let i = 0; i < othersKeys.length; i++) {
                    if (othersKeys[i] === 'stack') {
                        const stacks = others[othersKeys[i]].split(',')
                        for (let j = 0; j < stacks.length; j++) {
                            if (having.length === 0) {
                                having += `having stacks like '%${stacks[j]}%'`
                            } else {
                                having += ` and stacks like '%${stacks[j]}%'`
                            }
                        }
                    } else if (othersKeys[i] === 'keywordCode') {
                        const keywordCodes = others[othersKeys[i]].split(',')
                        for (let j = 0; j < keywordCodes.length; j++) {
                            if (having.length === 0) {
                                having += `having keywordCodes like '%${keywordCodes[j]}%'`
                            } else {
                                having += ` and keywordCodes like '%${keywordCodes[j]}%'`
                            }
                        }
                    } else if (othersKeys[i] === 'search') {
                        const searchWords = others[othersKeys[i]].split(' ')
                        for (let j = 0; j < searchWords.length; j++) {
                            if (where.length === 0) {
                                where += `where company_name like '%${searchWords[j]}%'
                            or title like '%${searchWords[j]}%'
                            or keywords like '%${searchWords[j]}%'
                            or stacks like '%${searchWords[j]}%'
                            or address_upper like '%${searchWords[j]}%'
                            or address_lower like '%${searchWords[j]}%'
                            or content like '%${searchWords[j]}%'`
                            } else {
                                where += ` and company_name like '%${searchWords[j]}%'
                            or title like '%${searchWords[j]}%'
                            or keywords like '%${searchWords[j]}%'
                            or stacks like '%${searchWords[j]}%'
                            or address_upper like '%${searchWords[j]}%'
                            or address_lower like '%${searchWords[j]}%'
                            or content like '%${searchWords[j]}%'`
                            }
                        }
                    } else if (othersKeys[i] === 'page') {
                        offset = (Number(others['page']) - 1) * limit
                    } else {
                        if (where.length === 0) {
                            where += `where ${othersKeys[i]}='${
                                others[othersKeys[i]]
                            }'`
                        } else {
                            where += ` and ${othersKeys[i]}='${
                                others[othersKeys[i]]
                            }'`
                        }
                    }
                }
            }

            let query = `select j.jobpost_id, company_name, original_img_url, title, keywords, keywordCodes, stacks, stackimgurls, likesCount, likedUsers, views, deadline_dtm, address_upper, address_lower from jobpost j 
                        left join (select jobpost_id, j.keyword_code, group_concat(j.keyword_code) as keywordCodes ,group_concat(keyword) as keywords from jobpostkeyword j 
                                    left join keyword k on j.keyword_code = k.keyword_code 
                                    group by j.jobpost_id) j2 on j.jobpost_id = j2.jobpost_id
                        left join (select jobpost_id, group_concat(stack) as stacks, group_concat(stack_img_url) as stackImgUrls from jobpoststack j 
                                    left join stack s on j.stack_id = s.stack_id  
                                    group by j.jobpost_id) j3 on j.jobpost_id = j3.jobpost_id
                        left join company c on j.company_id = c.company_id 
                        left join (select j.jobpost_id, count(user_id) as likesCount, group_concat(user_id) as likedUsers from jobfit.jobpost j 
                                    left join jobfit.likedjobpost l on j.jobpost_id = l.jobpost_id
                                    group by j.jobpost_id) l on j.jobpost_id = l.jobpost_id ${where}
                        ${having}
                        order by ${sort}
                        limit ? offset ?`

            const values = [limit, offset]

            const likedUser = await this.cacheService.getAllLikedjobpost()

            const data = await this.query(query, values)

            query = `select count(*) as totalCount
                    from (select keywordCodes, stacks from jobpost j 
                    left join (select jobpost_id, j.keyword_code, group_concat(j.keyword_code) as keywordCodes ,group_concat(keyword) as keywords from jobpostkeyword j 
                    left join keyword k on j.keyword_code = k.keyword_code 
                    group by j.jobpost_id) j2 on j.jobpost_id = j2.jobpost_id
                    left join (select jobpost_id, group_concat(stack) as stacks, group_concat(stack_img_url) as stackImgUrls from jobpoststack j 
                    left join stack s on j.stack_id = s.stack_id  
                    group by j.jobpost_id) j3 on j.jobpost_id = j3.jobpost_id
                    left join company c on j.company_id = c.company_id 
                    left join (select j.jobpost_id, count(user_id) as likesCount, group_concat(user_id) as likedUsers from jobfit.jobpost j 
                    left join jobfit.likedjobpost l on j.jobpost_id = l.jobpost_id
                    group by j.jobpost_id) l on j.jobpost_id = l.jobpost_id ${where}
                    ${having}
                    order by ${sort}) as results`

            const totalCount = await this.query(query, values)

            return {
                data,
                totalCount: Number(totalCount[0].totalCount),
                likedUser,
            }
        }
    }

    async getAddresses() {
        const addressUpper = await this.query(`select address_upper
                                                from jobpost j
                                                where address_upper is not null
                                                group by address_upper 
                                                order by address_upper asc`)

        const addressLower = await this
            .query(`select address_upper, address_lower
                    from jobpost j 
                    where address_lower is not null and address_upper is not null
                    group by address_lower 
                    order by address_upper asc, address_lower asc`)

        return { addressUpper, addressLower }
    }

    async getStacks() {
        return await this.query(`select j2.stack, j2.category
                                from jobpost j
                                left join (select j.stack_id, j.jobpost_id, stack, category
                                from jobpoststack j 
                                left join stack s on j.stack_id = s.stack_id) j2 on j.jobpost_id = j2.jobpost_id
                                where j2.stack is not null
                                group by j2.stack
                                order by j2.category asc, j2.stack asc`)
    }

    async getKeywords() {
        return await this
            .query(`select jobpost_id, j.keyword_code, keyword from jobpostkeyword j 
                    left join keyword k on j.keyword_code = k.keyword_code 
                    group by keyword_code
                    order by keyword asc`)
    }

    async insertLike(userId: number, jobpostId: number) {
        let query = `insert into likedjobpost(jobpost_id, user_id) values (?, ?)`
        const values = [jobpostId, userId]
        try {
            await this.query(query, values)
        } catch (err) {
            console.log(err)
        }
    }

    async deleteLike(userId: number, jobpostId: number) {
        let query = `delete from likedjobpost where jobpost_id = ? and user_id=  ?`
        const values = [jobpostId, userId]
        try {
            await this.query(query, values)
        } catch (err) {
            console.log(err)
        }
    }

    // 채용공고 상세정보
    async getJobpostDetail(jobpostId: number) {
        try {
            return await this.createQueryBuilder('jobpost')
                .leftJoinAndSelect('jobpost.company', 'company')
                .leftJoinAndSelect('jobpost.keywords', 'keyword')
                .leftJoinAndSelect('jobpost.stacks', 'stack')
                .where('jobpost.jobpost_id = :jobpostId', { jobpostId })
                .getOne()
        } catch (error) {
            return { message: '상세정보를 불러올 수 없습니다.' }
        }
    }
}
