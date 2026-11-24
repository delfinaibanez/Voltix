# Índice de evidencias

Cada archivo es la salida real de una corrida contra el stack de Docker Compose.

| TP | Qué demuestra | Archivo |
| --- | --- | --- |
| TP4 | Pruebas del cluster Raft (`npm run test:raft`, 2 pass, 0 fail) | `tp04-raft-tests.txt` |
| TP4 | Failover: cae el líder, se elige uno nuevo y el nodo vuelve como follower | `tp04-failover-raft.txt` |
| TP5 | Análisis y diseño (inventario, acoplamientos, fichas, matrices, casos de uso, checklist, trazabilidad) | `../TP5-analisis-y-diseno.md` |
| TP6 | Escenarios de microservicios en Docker Compose (37 pass, 0 fail) | `tp06-corrida-final-37-pass.txt` |
| TP6 | Reconciliación persistente de liberaciones pendientes | `tp06-con-reconciliacion.txt` |
| TP6 | Persistencia tras caída y reinicio (12 pass, 0 fail) | `tp06-persistencia.txt` |
| TP7 | Seguridad, escenarios A a L completos (33 pass, 0 fail, 0 skip) | `tp07-corrida-completa-final.txt` |

## Corridas anteriores (se conservan como historial)

- `tp07-corrida-1-completa.txt`: primera corrida de TP7. Tuvo 4 fallos porque el script apuntaba a un nodo de inventario que en ese momento era follower (un follower responde 307 y el cliente descarta el header `Authorization`). Se corrigió apuntando el script al líder.
- `tp07-corrida-final-31-pass.txt`: corrida intermedia de TP7 (31 pass, 0 fail) con `--sin-docker`.

## Cómo repetirlas

Ver `scripts/pruebas/README.md` (variables de entorno, cómo encontrar el líder de Raft y qué hace cada script).
