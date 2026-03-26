import { Controller, Post, Get, Put, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import {
  PlayerService,
  CreateAnonymousPlayerDto,
  LinkAccountDto,
  LoginDto,
} from './player.service';

@Controller('players')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post('anonymous')
  async createAnonymous(@Body() data: CreateAnonymousPlayerDto) {
    return this.playerService.createAnonymousPlayer(data);
  }

  @Get(':token')
  async getPlayer(@Param('token') token: string) {
    return this.playerService.getPlayerByToken(token);
  }

  @Put(':token')
  async updatePlayer(
    @Param('token') token: string,
    @Body() data: { username?: string; avatar?: string; avatarType?: string },
  ) {
    return this.playerService.updatePlayer(token, data);
  }

  @Post('link')
  async linkAccount(@Body() data: LinkAccountDto) {
    return this.playerService.linkAccount(data);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() data: LoginDto) {
    return this.playerService.login(data);
  }
}
