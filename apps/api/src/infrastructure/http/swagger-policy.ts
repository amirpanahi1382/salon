import { isSwaggerEnabled, type AppConfig } from '@salon/config';

export { isSwaggerEnabled };

export function swaggerPolicy(config: AppConfig): { enabled: boolean } {
  return { enabled: isSwaggerEnabled(config) };
}
