const { DataTypes } = require('sequelize');

module.exports = function defineSetting(sequelize) {
  const Setting = sequelize.define(
    'Setting',
    {
      key: { type: DataTypes.STRING, primaryKey: true },
      type: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      tableName: 'settings',
      timestamps: true, // createdAt, updatedAt
    }
  );
  return Setting;
}