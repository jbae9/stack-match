import { Injectable } from '@nestjs/common'
import {
    RedisOptionsFactory,
    RedisModuleOptions,
} from '@liaoliaots/nestjs-redis'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class RedisConfigService implements RedisOptionsFactory {
    constructor(private configService: ConfigService) {}

    async createRedisOptions(): Promise<RedisModuleOptions> {
        return {
            config: {
                url: this.configService.get('REDIS_URL'),
            },
        }
    }
}
