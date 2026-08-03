import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter, ErrorEnvelope } from '../src/common/all-exceptions.filter';

function makeHost(): {
  host: ArgumentsHost;
  captured: { status?: number; body?: ErrorEnvelope };
} {
  const captured: { status?: number; body?: ErrorEnvelope } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ErrorEnvelope) {
      captured.body = body;
      return this;
    },
  };
  const req = { requestId: 'req-123', method: 'GET', url: '/x' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('renders the error envelope with message/code/requestId and preserves status', () => {
    const { host, captured } = makeHost();
    filter.catch(new BadRequestException('bad input'), host);

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toEqual({
      error: {
        message: 'bad input',
        code: 'BAD_REQUEST',
        requestId: 'req-123',
      },
    });
  });

  it('maps a generic thrown Error to 500 INTERNAL_SERVER_ERROR', () => {
    const { host, captured } = makeHost();
    filter.catch(new Error('boom'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body?.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(captured.body?.error.message).toBe('boom');
    expect(captured.body?.error.requestId).toBe('req-123');
  });

  it('joins class-validator array messages into one string', () => {
    const { host, captured } = makeHost();
    filter.catch(
      new HttpException(
        { message: ['a must be a string', 'b is required'], error: 'Bad Request' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      host,
    );
    expect(captured.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(captured.body?.error.message).toBe('a must be a string, b is required');
    expect(captured.body?.error.code).toBe('UNPROCESSABLE_ENTITY');
  });
});
