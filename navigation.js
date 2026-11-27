// Keep the desktop contents visible and give small screens a native disclosure.
const sidebarMenu = document.querySelector('.sidebar-menu');
if (sidebarMenu) {
  const narrowScreen = window.matchMedia('(max-width: 900px)');
  function syncMenu() {
    sidebarMenu.open = !narrowScreen.matches;
  }
  syncMenu();
  narrowScreen.addEventListener('change', syncMenu);
  sidebarMenu.addEventListener('click', event => {
    if (narrowScreen.matches && event.target.closest('a[href^="#"]')) {
      sidebarMenu.open = false;
    }
  });
}
