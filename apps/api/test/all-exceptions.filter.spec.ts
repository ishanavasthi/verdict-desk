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

  it('maps a generic thrown Error to an OPAQUE 500 (never echoes the internal message)', () => {
    const { host, captured } = makeHost();
    filter.catch(new Error('boom'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body?.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(captured.body?.error.message).toBe('Internal server error');
    expect(captured.body?.error.message).not.toContain('boom');
    expect(captured.body?.error.requestId).toBe('req-123');
  });

  // Regression: a Prisma error's `message` carries the absolute source path of
  // the calling file, a code frame, and constraint names. None of that may ever
  // reach a client — including on the UNAUTHENTICATED GET /problems/:id route.
  it('never leaks Prisma internals (source paths, code frames) to the client', () => {
    const { host, captured } = makeHost();
    const prismaish = Object.assign(
      new Error(
        'Invalid `this.prisma.problem.findUnique()` invocation in\n' +
          '/Users/someone/verdict-desk/apps/api/src/problems/problems.controller.ts:52:47\n' +
          'Inconsistent column data: Error creating UUID, invalid character',
      ),
      { code: 'P2023' },
    );
    filter.catch(prismaish, host);

    const message = captured.body?.error.message ?? '';
    expect(message).not.toContain('/Users/');
    expect(message).not.toContain('prisma');
    expect(message).not.toContain('invocation');
  });

  it('maps known bad-request Prisma codes to 4xx with a fixed generic message', () => {
    const cases = [
      { code: 'P2023', status: HttpStatus.BAD_REQUEST, message: 'malformed identifier in request' },
      { code: 'P2003', status: HttpStatus.BAD_REQUEST, message: 'referenced record does not exist' },
      { code: 'P2025', status: HttpStatus.NOT_FOUND, message: 'record not found' },
    ];

    for (const c of cases) {
      const { host, captured } = makeHost();
      filter.catch(Object.assign(new Error('internal detail'), { code: c.code }), host);

      expect(captured.status).toBe(c.status);
      expect(captured.body?.error.message).toBe(c.message);
    }
  });

  it('falls back to an opaque 500 for an UNKNOWN Prisma code', () => {
    const { host, captured } = makeHost();
    filter.catch(Object.assign(new Error('some new prisma failure'), { code: 'P9999' }), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body?.error.message).toBe('Internal server error');
  });

  it('still returns the message of a DELIBERATE HttpException (written for the client)', () => {
    const { host, captured } = makeHost();
    filter.catch(new BadRequestException('problemId must be a UUID'), host);

    expect(captured.body?.error.message).toBe('problemId must be a UUID');
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
