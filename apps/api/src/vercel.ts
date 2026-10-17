// Entrada de la función de Vercel (Node, req/res). La app Hono es la misma que en dev.
import { handle } from '@hono/node-server/vercel';
import app from './index';

export default handle(app);
