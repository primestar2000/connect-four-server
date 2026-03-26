import { Module, forwardRef } from '@nestjs/common';
import { TournamentGateway } from './tournament.gateway';
import { TournamentService } from './tournament.service';
import { GameModule } from '../game/game.module';

@Module({
  imports: [forwardRef(() => GameModule)],
  providers: [TournamentGateway, TournamentService],
  exports: [TournamentService, TournamentGateway],
})
export class TournamentModule {}
