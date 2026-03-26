import { Module, forwardRef } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { TournamentModule } from '../tournament/tournament.module';

@Module({
  imports: [forwardRef(() => TournamentModule)],
  providers: [GameGateway, GameService],
  exports: [GameService],
})
export class GameModule {}
