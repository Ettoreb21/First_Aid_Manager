const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MaterialLog = sequelize.define(
    'MaterialLog',
    {
      id_log: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      id_record: { type: DataTypes.INTEGER, allowNull: false },
      utente: { type: DataTypes.STRING, allowNull: true },
      operazione: { type: DataTypes.ENUM('INSERT', 'UPDATE', 'DELETE'), allowNull: false },
      timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'material_logs',
      timestamps: false,
      underscored: true,
    }
  );

  return MaterialLog;
};