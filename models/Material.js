const { DataTypes } = require('sequelize');

function getEnv(name, fallback) {
  return process.env[name] && process.env[name].trim() !== ''
    ? process.env[name]
    : fallback;
}

module.exports = (sequelize) => {
  const thresholdDays = parseInt(getEnv('EXPIRY_THRESHOLD_DAYS', '30'), 10);

  const Material = sequelize.define(
    'Material',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nome_materiale: { type: DataTypes.STRING, allowNull: false },
      categoria: { type: DataTypes.STRING, allowNull: true },
      quantita: { type: DataTypes.INTEGER, allowNull: true },
      unita_misura: { type: DataTypes.STRING, allowNull: true },
      data_acquisizione: { type: DataTypes.DATEONLY, allowNull: true },
      data_scadenza: { type: DataTypes.DATEONLY, allowNull: true },
      fornitore: { type: DataTypes.STRING, allowNull: true },
      note: { type: DataTypes.TEXT, allowNull: true },
      stato_scadenza: {
        type: DataTypes.VIRTUAL,
        get() {
          const raw = this.getDataValue('data_scadenza');
          if (!raw) return 'OK';
          const now = new Date();
          const exp = new Date(raw);
          // Normalize dates (no time) for DAY-level compare
          const dayMs = 24 * 60 * 60 * 1000;
          const diffDays = Math.floor((exp.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / dayMs);
          if (diffDays < 0) return 'Scaduto';
          if (diffDays <= thresholdDays) return 'In scadenza';
          return 'OK';
        },
      },
    },
    {
      tableName: 'materiali',
      timestamps: true,
      underscored: true,
    }
  );

  return Material;
};