import { buildApp } from './app';

const app = buildApp();

export default {
  fetch: (request: Request): Response | Promise<Response> => app.fetch(request),
};
