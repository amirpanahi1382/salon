import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

const synthetic = 'PHONE_FAKE_09120000000 BODY_FAKE_HELLO MONEY_FAKE_1234.56 TOKEN_FAKE_XYZ DBURL_FAKE_postgres OBJECT_FAKE_vip/key';

@Module({
  providers: [{ provide: 'FAILING_DEPENDENCY', useFactory: () => {
    const error = new Error(synthetic);
    error.stack = `bootstrap stack ${synthetic}`;
    throw error;
  } }],
})
class FailingModule {}

describe('bootstrap logging boundary', () => {
  it('suppresses the raw Nest initialization error before a safe bootstrap handler can report it', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(NestFactory.createApplicationContext(FailingModule, {
      logger: false,
      abortOnError: false,
    })).rejects.toThrow(synthetic);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(synthetic);
    logged.mockRestore();
  });
});
