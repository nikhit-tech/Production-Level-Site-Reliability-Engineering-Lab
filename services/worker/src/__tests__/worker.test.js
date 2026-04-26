process.env.DB_PASSWORD = 'testpassword';
process.env.NODE_ENV = 'test';

jest.mock('bull', () =>
  jest.fn().mockImplementation(() => ({
    process: jest.fn(),
    add: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue({}),
    getWaiting: jest.fn().mockResolvedValue([]),
  }))
);

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
  }))
);

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

describe('Worker module', () => {
  let worker;

  beforeAll(() => {
    worker = require('../index');
  });

  it('exports queue interfaces', () => {
    expect(worker).toHaveProperty('emailQueue');
    expect(worker).toHaveProperty('orderProcessingQueue');
    expect(worker).toHaveProperty('inventoryQueue');
    expect(worker).toHaveProperty('healthCheck');
  });

  it('healthCheck returns status object', async () => {
    const result = await worker.healthCheck();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('timestamp');
  });
});
