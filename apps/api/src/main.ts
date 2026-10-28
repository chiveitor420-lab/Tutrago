import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    })
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`====================================================`);
  console.log(`🚀 Tutrago API Gateway ejecutándose en el puerto ${port}`);
  console.log(`📡 WebSocket Gateway listo para salas bar_* y ticket_*`);
  console.log(`====================================================`);
}

bootstrap();
