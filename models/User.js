module.exports = function defineUser(sequelize) {
  const { DataTypes } = require('sequelize');
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 100],
      },
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { len: [1, 100] },
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { len: [1, 100] },
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [["master", "amministratore", "ospite"]],
      },
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    signaturePath: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }, {
    tableName: 'users',
    timestamps: true,
    underscored: false,
  });

  return User;
}