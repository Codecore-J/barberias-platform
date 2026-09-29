import { Injectable } from '@nestjs/common';

export interface ApiMetadata {
  name: string;
  version: string;
  status: string;
  environment: string;
  timestamp: string;
  healthEndpoint: string;
}

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getMetadata(): ApiMetadata {
    return {
      name: 'Barberias Platform API',
      version: '1.0.0',
      status: 'online',
      environment: process.env.NODE_ENV || 'production',
      timestamp: new Date().toISOString(),
      healthEndpoint: '/api/v1/health',
    };
  }
}
