/** The chrome every page renders inside: the header, the search dialog, and the account menu. */
export default {
  header: {
    brand: "Louma",
    logoAlt: "Louma logo",
    searchAria: "Search",
    accountMenuAria: "Account menu",
  },
  search: {
    dialogAria: "Search Louma",
    placeholder: "Search pages, transfers, and settings",
    mostUsed: "Most used",
    results: "Results",
    noMatches: "No matches for “{query}”.",
    cantFind: "Can't find what you need?",
    newTransfer: "New transfer",
  },
  menu: {
    fallbackName: "Louma wallet",
    notSignedIn: "Not signed in",
    profile: "Profile",
    security: "Security",
    settings: "Settings",
    darkMode: "Dark mode",
    logOut: "Log out",
    language: "Language",
    signOutFailedTitle: "Sign-out was not confirmed",
    signOutFailedDetail: "{reason} The session on this device may still be active. Try again.",
  },
  breadcrumb: {
    home: "Home",
  },
  notice: {
    frozen: "The wallet is frozen, so every transfer is refused until you unfreeze it.",
  },
  /** The document itself: the browser tab and the description search engines would read. */
  document: {
    title: "Louma — Wallet",
    description: "Louma wallet: balance, transfers, mining, and transactions.",
  },
  notFound: {
    title: "Page not found",
    detail: "The page you're looking for doesn't exist or has been moved.",
    goHome: "Go home",
  },
  fatal: {
    title: "This page didn't load",
    detail: "Something went wrong on our end. You can try refreshing or head back home.",
    retry: "Try again",
    goHome: "Go home",
  },
  error: {
    unavailable: "Wallet unavailable",
    tryAgain: "Try again",
    frozenTitle: "Wallet frozen",
    frozenDetail:
      "Every transfer is refused while the wallet is frozen. Nothing was taken: unfreeze it and the wallet works as before.",
    openFreeze: "Open Freeze Wallet",
  },
};
