import { Builder, By, Key, until, WebDriver } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome'

const selenium = async () => {
    const options = new Options()
    options.setPageLoadStrategy('normal')
    options.excludeSwitches('enable-logging')

    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build()

    const driverBody = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build()

    try {
        await driver.get(
            'https://www.wanted.co.kr/wdlist/518?country=kr&job_sort=job.latest_order&years=-1&locations=all'
        )

        let lastHeight = await driver.executeScript(
            'return document.body.scrollHeight'
        )

        let newHeight
        while (true) {
            await driver.executeScript(
                'window.scrollTo(0, document.body.scrollHeight)'
            )

            await new Promise((resolve) => setTimeout(resolve, 3000))

            newHeight = await driver.executeScript(
                'return document.body.scrollHeight'
            )

            console.log(lastHeight)
            console.log(newHeight)
            if (newHeight == lastHeight) {
                break
            }
            lastHeight = newHeight
        }

        const allJobs = await driver.findElements(
            By.css(`div[data-cy="job-card"]`)
        )
        console.log('allJobs')

        const allJobsArr = []
        for (let i = 0; i < allJobs.length; i++) {
            const originalUrl = await allJobs[i]
                .findElement(By.css('a'))
                .getAttribute('href')

            const originalImgUrl = await allJobs[i]
                .findElement(By.css('a > header'))
                .getAttribute('style')

            const title = await allJobs[i]
                .findElement(By.className('job-card-position'))
                .getText()
            const companyName = await allJobs[i]
                .findElement(By.className('job-card-company-name'))
                .getText()
            const address = await allJobs[i]
                .findElement(By.className('job-card-company-location'))
                .getText()

            await driverBody.get(originalUrl)

            const content = await driverBody
                .findElement(
                    By.css(
                        '#__next > div.JobDetail_cn__WezJh > div.JobDetail_contentWrapper__DQDB6 > div.JobDetail_relativeWrapper__F9DT5 > div > div.JobContent_descriptionWrapper__SM4UD > section'
                    )
                )
                .getAttribute('innerHTML')

            allJobsArr.push({
                originalUrl: originalUrl,
                originalImgUrl: originalImgUrl,
                title: title,
                companyName: companyName,
                address: address,
                content: content,
            })
        }

        console.log(allJobsArr)
    } catch (error) {
        console.log(error)
    } finally {
        await driver.quit()
    }
}

selenium()
