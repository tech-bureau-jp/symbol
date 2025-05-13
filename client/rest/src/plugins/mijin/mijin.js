/** @module plugins/mijin */
import mijinRoutes from "./mijinRoutes.js";

/**
 * Creates a mijin plugin.
 * @type {module:plugins/CatapultRestPlugin}
 */
export default {
  createDb: (db) => db,

  registerTransactionStates: () => {},

  registerMessageChannels: () => {},

  registerRoutes: (...args) => {
    mijinRoutes.register(...args);
  },
};
