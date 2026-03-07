import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  const port = process.env.PORT || 3002;
  await app.listen(port);
  console.log(`🚀 Connect Four WebSocket server running on http://localhost:${port}`);
}

bootstrap();
