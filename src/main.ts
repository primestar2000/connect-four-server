import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  await app.listen(3002);
  console.log('🚀 Connect Four WebSocket server running on http://localhost:3002');
}

bootstrap();
