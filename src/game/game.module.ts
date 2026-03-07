import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { TournamentModule } from '../tournament/tournament.module';

@Module({
  imports: [TournamentModule],
  providers: [GameGateway, GameService],
  exports: [GameService],
})
export class GameModule {}
