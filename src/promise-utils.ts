import { AttemptOptions, retry, sleep } from '@lifeomic/attempt';

// From https://github.com/api3dao/airnode/blob/e50dafe57a0a083fd9fc3b2816fe8352a673038d/packages/airnode-node/src/utils/promise-utils.ts#L23
// The default amount of time before a "retryable" promise is timed out and retried
export const DEFAULT_RETRY_TIMEOUT_MS = 5_000;
// The default amount of time to wait before retrying a given promise
export const DEFAULT_RETRY_DELAY_MS = 50;

// Adapted from:
// https://github.com/then/is-promise
export function isPromise(obj: any) {
  return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
}

export type GoResult<T> = [Error, null] | [null, T];

export interface PromiseOptions {
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
}

export interface RetryOptions extends PromiseOptions {
  readonly retries: number;
}

// Go style async handling
export function go<T>(fn: () => Promise<T>, options?: PromiseOptions): Promise<GoResult<T>> {
  function successFn(value: T): [null, T] {
    return [null, value];
  }
  function errorFn(err: Error): [Error, null] {
    return [err, null];
  }

  if (options?.retries) {
    const optionsWithRetries = { ...options, retries: options.retries! };
    return retryOperation(fn, optionsWithRetries).then(successFn).catch(errorFn);
  }

  if (options?.timeoutMs) {
    return promiseTimeout(options.timeoutMs, fn()).then(successFn).catch(errorFn);
  }

  return fn().then(successFn).catch(errorFn);
}

export async function retryOperation<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  // We may want to use some of these options in the future
  const attemptOptions: AttemptOptions<any> = {
    delay: options.retryDelayMs || DEFAULT_RETRY_DELAY_MS,
    maxAttempts: options.retries + 1,
    initialDelay: 0,
    minDelay: 0,
    maxDelay: 0,
    factor: 0,
    timeout: options.timeoutMs || 0,
    jitter: false,
    handleError: null,
    handleTimeout: null,
    beforeAttempt: null,
    calculateDelay: null,
  };
  return retry((_context) => operation(), attemptOptions);
}

export interface ContinuousRetryOptions {
  readonly delay?: number;
}

export function promiseTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  let mutableTimeoutId: NodeJS.Timeout;
  const timeout = new Promise((_res, reject) => {
    mutableTimeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out in ${ms} ms.`));
    }, ms);
  });

  const wrappedPromise = promise.finally(() => {
    if (mutableTimeoutId) {
      clearTimeout(mutableTimeoutId);
    }
  });

  return Promise.race([wrappedPromise, timeout]) as Promise<T>;
}

export function retryOnTimeout<T>(maxTimeoutMs: number, operation: () => Promise<T>, options?: ContinuousRetryOptions) {
  const promise = new Promise<T>((resolve, reject) => {
    function run(): Promise<any> {
      // If the promise is successful, resolve it and bubble the result up
      return operation()
        .then(resolve)
        .catch((reason: any) => {
          // Only if the error is a timeout error, do we retry the promise
          if (reason instanceof Error && reason.message.includes('Operation timed out')) {
            // Delay the new attempt slightly
            return sleep(options?.delay || DEFAULT_RETRY_DELAY_MS)
              .then(run)
              .then(resolve)
              .catch(reject);
          }

          // If the error is NOT a timeout error, then we reject immediately
          return reject(reason);
        });
    }

    return run();
  });

  return promiseTimeout(maxTimeoutMs, promise);
}
