const menu = document.querySelector('.menu');
const mobileNav = document.querySelector('.mobile-nav');

menu?.addEventListener('click', () => {
  const isOpen = mobileNav?.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(!!isOpen));
  menu.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  menu.textContent = isOpen ? '×' : '☰';
});

document.querySelectorAll('.mobile-nav a').forEach(link => {
  link.addEventListener('click', () => {
    mobileNav?.classList.remove('open');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open menu');
    if (menu) menu.textContent = '☰';
  });
});
