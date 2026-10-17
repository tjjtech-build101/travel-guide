// Vista Ahora (PRD 19): la principal en la calle. Se completa en la rama prd-19-ahora.
import { SCOUT } from '@build101/shared';

import { EmptyState } from '../../../../ui/States';

export default function NowTab() {
  return <EmptyState title="Ahora" subtitle={`Qué toca ahora, qué sigue y acceso rápido a ${SCOUT.name}.`} />;
}
