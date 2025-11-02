const { DataTypes } = require('sequelize');

module.exports = function defineButtonState(sequelize) {
  const ButtonState = sequelize.define(
    'ButtonState',
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      data: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      tableName: 'button_states',
      timestamps: true, // createdAt, updatedAt
    }
  );
  return ButtonState;
}