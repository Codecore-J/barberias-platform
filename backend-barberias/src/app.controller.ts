import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './iam/infrastructure/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getRoot() {
    return this.appService.getMetadata();
  }
}
