// Export module for operating system
omega_edit = require("./omega_edit_" + process.platform)
module.exports = omega_edit
