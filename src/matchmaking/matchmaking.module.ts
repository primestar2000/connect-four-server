import { Module } from '@nestjs/common';
import { MatchmakingGateway } from './matchmaking.gateway';
import { MatchmakingService } from './matchmaking.service';
import { GameModule } from '../game/game.module';

@Module({
  imports: [GameModule],
  providers: [MatchmakingGateway, MatchmakingService],
})
export class MatchmakingModule {}
