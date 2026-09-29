import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('debe retornar los metadatos de la API', () => {
      const result = appController.getRoot();
      expect(result.name).toBe('Barberias Platform API');
      expect(result.status).toBe('online');
      expect(result.healthEndpoint).toBe('/api/v1/health');
    });
  });
});
