/**
 * EmissionBus — decouples GameOrchestrator from Socket.io.
 *
 * Orchestrator emits emissions to this bus instead of calling
 * Socket.io directly. SocketManager subscribes and routes them.
 *
 * Two channels:
 *   'emission'  — queued emissions from orchestrator method returns
 *   'immediate' — real-time emissions (timer ticks, rotations)
 */

const EventEmitter = require('events');

class EmissionBus extends EventEmitter {
  /**
   * Emit an array of emissions (from orchestrator method returns).
   * SocketManager listens on the 'emission' event.
   * @param {Array<{target, targetId, event, payload}>} emissions
   */
  emitAll(emissions) {
    if (!emissions) return;
    for (const e of emissions) {
      this.emit('emission', e);
    }
  }

  /**
   * Emit a single immediate emission (timer ticks, rotations).
   * SocketManager listens on the 'immediate' event.
   * @param {{target, targetId, event, payload}} emission
   */
  emitImmediate(emission) {
    this.emit('immediate', emission);
  }
}

module.exports = EmissionBus;
