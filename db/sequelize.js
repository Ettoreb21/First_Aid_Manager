const { Sequelize } = require('sequelize');

let sequelize;
let models = {};

function getEnv(name, fallback) {
  return process.env[name] && process.env[name].trim() !== ''
    ? process.env[name]
    : fallback;
}

function initSequelize() {
  const dialect = getEnv('DB_DIALECT', 'postgres');

  if (dialect === 'sqlite') {
    const storage = getEnv('DB_SQLITE_PATH', './materials.sqlite');
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage,
      logging: false,
    });
  } else {
    // Supporta DATABASE_URL (Render/Heroku) con SSL abilitato
    const databaseUrl = getEnv('DATABASE_URL', '');
    const isProd = String(getEnv('NODE_ENV', 'development')).toLowerCase() === 'production';
    const sslRequired = isProd || String(getEnv('PG_SSL', '')).toLowerCase() === 'true';

    if (databaseUrl) {
      sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        protocol: 'postgres',
        logging: false,
        dialectOptions: sslRequired ? { ssl: { require: true, rejectUnauthorized: false } } : {},
      });
    } else {
      // Fallback su parametri individuali
      const host = getEnv('DB_HOST', 'localhost');
      const port = parseInt(getEnv('DB_PORT', '5432'), 10);
      const database = getEnv('DB_NAME', 'materials_db');
      const username = getEnv('DB_USER', 'postgres');
      const password = getEnv('DB_PASSWORD', 'postgres');
      sequelize = new Sequelize(database, username, password, {
        host,
        port,
        dialect,
        logging: false,
        dialectOptions: sslRequired ? { ssl: { require: true, rejectUnauthorized: false } } : {},
      });
    }
  }

  // Load models
  const defineMaterial = require('../models/Material');
  const defineMaterialLog = require('../models/MaterialLog');
  const defineSetting = require('../models/Setting');
  const defineButtonState = require('../models/ButtonState');
  const defineUser = require('../models/User');
  const Material = defineMaterial(sequelize);
  const MaterialLog = defineMaterialLog(sequelize);
  const Setting = defineSetting(sequelize);
  const ButtonState = defineButtonState(sequelize);
  const User = defineUser(sequelize);

  // Associations
  Material.hasMany(MaterialLog, { foreignKey: 'id_record', as: 'logs' });
  MaterialLog.belongsTo(Material, { foreignKey: 'id_record', as: 'material' });

  models = { Material, MaterialLog, Setting, ButtonState, User };

  return sequelize
    .authenticate()
    .then(() => sequelize.sync())
    .then(() => ({ sequelize, models }))
    .catch((err) => {
      console.error('Sequelize init error:', err.message);
      throw err;
    });
}

module.exports = {
  initSequelize,
  getSequelize: () => sequelize,
  models: () => models,
};