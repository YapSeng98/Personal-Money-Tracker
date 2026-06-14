// ============================================================
// PFMT Dashboard Widget — Client Controller (AngularJS)
// Paste into: Client Controller tab of the widget
// ============================================================

function(c) {
  // Reload data from server controller
  c.refreshData = function() {
    c.server.update().then(function(response) {
      c.data = response.data;
    });
  };

  // Emit event to open the Add Transaction modal
  c.addTransaction = function(type) {
    $scope.$emit('pfmt:openAddModal', { defaultType: type });
  };
}
