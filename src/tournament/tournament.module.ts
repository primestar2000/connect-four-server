import { Module } from '@nestjs/common';
import { TournamentGateway } from './tournament.gateway';
import { TournamentService } from './tournament.service';

@Module({
  providers: [TournamentGateway, TournamentService],
  exports: [TournamentService, TournamentGateway],
})
export class TournamentModule {}
