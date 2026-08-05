import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { DEFAULT_LOGIN_PER_MIN, RATE_LIMIT_LOGIN_ENV, RATE_LIMIT_WINDOW_MS, envLimit } from '../common/rate-limit.config';
import { AuthService, AuthUserView } from './auth.service';
import { AUTH_COOKIE_MAX_AGE_MS, AUTH_COOKIE_NAME, authCookieOptions } from './cookie';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequestUser } from './types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Keyed by client IP (no auth cookie exists yet at login time) — bounds
  // brute-force password guessing against a single account/source.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @Throttle({
    default: { limit: envLimit(RATE_LIMIT_LOGIN_ENV, DEFAULT_LOGIN_PER_MIN), ttl: RATE_LIMIT_WINDOW_MS },
  })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<AuthUserView> {
    const user = await this.auth.validateUser(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('invalid email or password');
    }
    const token = this.auth.sign(user);
    res.cookie(AUTH_COOKIE_NAME, token, { ...authCookieOptions(), maxAge: AUTH_COOKIE_MAX_AGE_MS });
    return AuthService.toView(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: RequestUser): Promise<AuthUserView> {
    const full = await this.auth.findById(user.id);
    if (!full) {
      // Valid JWT, but the user was deleted since it was signed.
      throw new UnauthorizedException('user no longer exists');
    }
    return AuthService.toView(full);
  }
}
