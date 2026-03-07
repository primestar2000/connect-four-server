import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { PrismaModule } from './prisma/prisma.module';
import { TournamentModule } from './tournament/tournament.module';
import { PlayerModule } from './player/player.module';

@Module({
  imports: [PrismaModule, PlayerModule, GameModule, MatchmakingModule, TournamentModule],
})
export class AppModule {}
