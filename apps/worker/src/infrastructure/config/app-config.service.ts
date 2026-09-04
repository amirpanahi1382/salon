import { Injectable } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@salon/config';

@Injectable()
export class AppConfigService {
  readonly values: AppConfig = loadConfig();
}
