/*
 * Scratch check for the house account (run from the project root):
 *   npx tsc app/lib/forum/post-layout.ts app/lib/auth/mock-auth.ts app/lib/auth/validation.ts app/lib/profile/mock-profile-repository.ts --outDir Temp/site-account-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/PostAuthorRow.tsx --outDir Temp/site-account-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-site-account.cjs
 *
 * Proves debaser.site is an account rather than a label:
 *   1. it signs in with ADMIN1212 / ADMIN1212, and that identifier is not an
 *      address, so signing *up* still demands a real one;
 *   2. its profile is seeded with the royal blue dye, and its own choice wins;
 *   3. the board credits an item-owned post to it, in royal blue, default pfp and
 *      all - until the account has drawn a picture of its own;
 *   4. the header links through to its public profile and carries no presence lamp;
 *   5. the account survives the account page's local purge and refuses deletion.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  SITE_ACCOUNT_ADDRESS,
  SITE_ACCOUNT_ID,
  SITE_ACCOUNT_NAME_COLOUR,
  isSiteAccount,
  resolveSignInAddress,
  showsPresenceLamp,
} = require('./site-account-out/auth/builtin-account.js');
const { getMockAuthRepository, resetMockAuth } = require('./site-account-out/auth/mock-auth.js');
const {
  validateSignIn,
  validateSignInIdentifier,
  validateSignUp,
} = require('./site-account-out/auth/validation.js');
const { buildPostLayout } = require('./site-account-out/forum/post-layout.js');
const { SITE_AUTHOR, SITE_AUTHOR_PICTURE } = require('./site-account-out/forum/site-author.js');
const { profileNameColour } = require('./site-account-out/profile/name-colours.js');
const { getMockProfileRepository } = require('./site-account-out/profile/mock-profile-repository.js');

const PostAuthorRow = require('./site-account-render/components/PostAuthorRow.js').default;
const AccountForms = require('./site-account-render/components/AccountForms.js').default;
const AuthProvider = require('./site-account-render/components/AuthProvider.js').default;
const PresenceProvider = require('./site-account-render/components/PresenceProvider.js').default;

const element = React.createElement;
const withProviders = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

const SHEET = {
  kind: 'asset',
  id: 'concept-sheet-01',
  label: 'SHEET 01 // FIGURE STUDY',
  href: '/concepts',
  preview: { src: '/assets/concepts/concept-sheet-01.png', alt: 'sheet', width: 352, height: 366 },
};
const BOARD = { kind: 'board', id: 'board', label: 'THE BOARD', href: '/forum' };

function thread(overrides) {
  return {
    id: 'thread-1',
    title: 'RE: SHEET 01 // FIGURE STUDY',
    body: '',
    author: { id: 'user-sweden', displayName: 'sweden' },
    createdAt: '2026-09-21T04:39:52.000Z',
    anchor: SHEET,
    tags: [],
    comments: [],
    origin: 'user',
    ...overrides,
  };
}

function layoutFor(subject, authorProfile) {
  return buildPostLayout({
    thread: subject,
    isOpen: true,
    authorProfile,
    postedLabel: 'POSTED 2026-09-21 04:39:52',
    repliesLabel: '0 REPLIES',
    imageSourceLabel: 'ITEM ARTWORK', // the label imageSourceLabel('item') gives since SPEC-less-text.md
    postImage: subject.anchor.preview,
  });
}

(async () => {
  // 1. The constants, and the credential rules they imply.
  assert.equal(SITE_AUTHOR.id, SITE_ACCOUNT_ID, 'the byline is the account');
  assert.equal(SITE_AUTHOR.displayName, 'debaser.site');
  assert.equal(SITE_ACCOUNT_NAME_COLOUR, '#1d3ca6', 'royal blue is a dye out of the eight');
  assert.equal(resolveSignInAddress('ADMIN1212'), SITE_ACCOUNT_ADDRESS);
  assert.equal(resolveSignInAddress(' User@Example.com '), 'User@Example.com', 'anything else is an address');
  assert.deepEqual(validateSignIn({ email: 'ADMIN1212', password: 'ADMIN1212' }), {}, 'identifier accepted');
  assert.equal(typeof validateSignInIdentifier('admin 1212'), 'string', 'spaces are still refused');
  assert.equal(
    typeof validateSignUp({
      email: 'ADMIN1212',
      displayName: 'house',
      password: 'ADMIN1212A',
      confirmPassword: 'ADMIN1212A',
    }).email,
    'string',
    'signing up still wants a real address',
  );
  assert.equal(isSiteAccount(SITE_ACCOUNT_ID), true);
  assert.equal(isSiteAccount('user-sweden'), false);
  assert.equal(showsPresenceLamp(null), false, 'guests have no lamp');
  assert.equal(showsPresenceLamp(SITE_ACCOUNT_ID), false, 'the house account has no lamp');
  assert.equal(showsPresenceLamp('user-sweden'), true);

  // 2. Seeding and sign-in.
  const auth = getMockAuthRepository();
  const signedIn = await auth.signIn({ email: 'ADMIN1212', password: 'ADMIN1212' });
  assert.equal(signedIn.ok, true, signedIn.ok ? '' : signedIn.error);
  assert.equal(signedIn.user.id, SITE_ACCOUNT_ID);
  assert.equal(signedIn.user.displayName, 'debaser.site');
  assert.equal(signedIn.user.email, SITE_ACCOUNT_ADDRESS);
  assert.equal((await auth.getCurrentUser()).id, SITE_ACCOUNT_ID, 'the session sticks');

  const wrongPassword = await auth.signIn({ email: 'ADMIN1212', password: 'ADMIN1213' });
  assert.equal(wrongPassword.ok, false);
  // (2026-10-25, SPEC-less-text.md) The auth refusals shortened, mock and Supabase alike: `THAT PASSWORD IS NOT
  // CORRECT.` -> `WRONG PASSWORD.`, `NO ACCOUNT FOUND FOR THAT EMAIL ADDRESS.` -> `NO ACCOUNT FOR THAT EMAIL.`,
  // `AN ACCOUNT ALREADY EXISTS FOR THAT EMAIL ADDRESS.` -> `THAT EMAIL ALREADY HAS AN ACCOUNT.`
  assert.equal(wrongPassword.error, 'WRONG PASSWORD.');

  const unknown = await auth.signIn({ email: 'nobody@example.com', password: 'ADMIN1212' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'NO ACCOUNT FOR THAT EMAIL.');

  // Updated on purpose (SPEC-test-accounts.md): the mock also holds a hidden test person now, which
  // the store answers for (so its name resolves) and no list shows (`listedAccounts`).
  const accounts = await auth.listAccounts();
  assert.deepEqual(
    accounts.filter((account) => account.hidden !== true).map((account) => account.id),
    [SITE_ACCOUNT_ID],
    'comms can find the house account, and lists nobody else',
  );
  assert.deepEqual(
    accounts.filter((account) => account.hidden === true).map((account) => account.id),
    ['mock-test-account'],
    'the hidden test person is there, flagged',
  );

  await auth.signOut();
  const lowerCase = await auth.signIn({ email: 'admin1212', password: 'ADMIN1212' });
  assert.equal(lowerCase.ok, true, 'the identifier is case-insensitive');
  await auth.signOut();
  const byAddress = await auth.signIn({ email: SITE_ACCOUNT_ADDRESS, password: 'ADMIN1212' });
  assert.equal(byAddress.ok, true, 'and its address works too');

  const duplicate = await auth.signUp({
    email: SITE_ACCOUNT_ADDRESS,
    displayName: 'imposter',
    password: 'passwordA1',
    confirmPassword: 'passwordA1',
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'THAT EMAIL ALREADY HAS AN ACCOUNT.');

  const refused = await auth.deleteAccount();
  assert.equal(refused.ok, false, 'the house account cannot be deleted');
  assert.match(refused.error, /HOUSE ACCOUNT/);
  assert.equal((await auth.getCurrentUser()).id, SITE_ACCOUNT_ID, 'and it is still here');

  // The account page's "[ CLEAR ALL LOCAL ACCOUNTS ]" plants it again at once,
  // so the owner is never locked out until a reload.
  resetMockAuth();
  assert.equal(await auth.getCurrentUser(), null, 'the purge signs everybody out');
  const afterPurge = await auth.signIn({ email: 'ADMIN1212', password: 'ADMIN1212' });
  assert.equal(afterPurge.ok, true, 'the house account survives a local purge');
  assert.equal(afterPurge.user.id, SITE_ACCOUNT_ID);
  // 3. The seeded profile, and its royal blue name.
  const profiles = getMockProfileRepository();
  const house = await profiles.getProfile(SITE_ACCOUNT_ID);
  assert.notEqual(house, null, 'the house profile is there before anybody writes one');
  assert.equal(house.displayName, 'debaser.site');
  assert.equal(house.nameColour, '#1d3ca6');
  assert.equal(profileNameColour(house), '#1d3ca6', 'royal blue is a real dye, not a stray hex');

  // 4. The board's byline.
  const owned = layoutFor(thread(), house);
  assert.equal(owned.author.credit.id, SITE_ACCOUNT_ID, 'an item-owned post is signed by the account');
  assert.equal(owned.author.name, 'debaser.site');
  assert.equal(owned.author.nameColour, '#1d3ca6', 'and drawn in its royal blue');
  assert.equal(owned.author.picture, SITE_AUTHOR_PICTURE, 'default pfp slot while it has no picture');
  assert.equal(owned.author.country, '', 'no country flag: the credit is the archive');
  assert.deepEqual(owned.author.displayedTags, [], 'no given tags on an item-owned post');
  assert.equal(owned.hasProfile, true);

  const guestOpened = layoutFor(thread({ author: { id: null, displayName: '' } }), house);
  assert.equal(guestOpened.author.credit.id, SITE_ACCOUNT_ID, 'a guest comment does not become the byline');
  assert.equal(guestOpened.author.name, 'debaser.site');

  await profiles.addAvatarVersion(SITE_ACCOUNT_ID, {
    src: '/assets/profiles/house.png',
    alt: 'house',
    note: 'check',
  });
  const withPicture = layoutFor(thread(), await profiles.getProfile(SITE_ACCOUNT_ID));
  assert.equal(withPicture.author.picture, undefined, 'its own picture replaces the default slot');
  assert.equal(withPicture.author.nameColour, '#1d3ca6');

  const plain = layoutFor(
    thread({ id: 'thread-2', body: 'hello archive', anchor: BOARD, author: { id: null, displayName: '' } }),
    null,
  );
  assert.equal(plain.author.credit.id, null);
  assert.equal(plain.author.name, 'Anonymous');
  assert.equal(plain.author.nameColour, undefined);
  assert.equal(plain.author.picture, undefined);
  assert.equal(plain.hasProfile, false);

  const person = layoutFor(
    thread({ id: 'thread-3', body: 'hello archive', anchor: BOARD }),
    await profiles.saveProfile('user-sweden', { displayName: 'sweden', nameColour: '#28c745' }),
  );
  assert.equal(person.author.credit.id, 'user-sweden');
  assert.equal(person.author.nameColour, '#28c745', 'a person keeps their own dye');
  assert.equal(person.author.picture, undefined);

  // The seed only fills a row that is missing: what the owner picks stays picked.
  await profiles.saveProfile(SITE_ACCOUNT_ID, { nameColour: '#28c745' });
  assert.equal((await profiles.getProfile(SITE_ACCOUNT_ID)).nameColour, '#28c745');
  await profiles.saveProfile(SITE_ACCOUNT_ID, { nameColour: '' });
  assert.equal((await profiles.getProfile(SITE_ACCOUNT_ID)).nameColour, undefined, 'default is reachable');

  // 5. The rendered header.
  const row = withProviders(
    element(PostAuthorRow, {
      author: SITE_AUTHOR,
      avatar: 'shown',
      avatarSize: 56,
      nameColour: SITE_ACCOUNT_NAME_COLOUR,
      picture: SITE_AUTHOR_PICTURE,
    }),
  );
  assert.match(row, /debaser\.site/);
  // The house account's name is Royal Blue, and the assertion is the *pair* now rather than one colour:
  // the name is drawn through `--name-ink` / `--name-ink-dark` and `.name-ink` chooses on `[data-theme]`,
  // because Royal Blue on the dark theme's Nigrosine field was 1.91:1. Asserting the pair is what keeps
  // the dark counterpart from being dropped by a later edit - and this account is the one it happened to.
  assert.match(row, /--name-ink:#1d3ca6/, 'the header draws the house blue name');
  assert.match(row, /--name-ink-dark:#fff000/, 'and its Daffodil counterpart for the dark field');
  assert.match(row, /class="name-ink"/, 'through the class the stylesheet picks a value on');
  assert.match(row, /href="\/profile\/debaser-site"/, 'and opens its public profile');
  assert.match(row, /avatar-default\.png/, 'with the default pfp slot, pointing at the file it will be');
  assert.match(row, /width:56px;height:56px/);

  const painted = withProviders(
    element(PostAuthorRow, {
      author: SITE_AUTHOR,
      avatar: 'shown',
      avatarSize: 56,
      nameColour: SITE_ACCOUNT_NAME_COLOUR,
    }),
  );
  // With no picture of its own, the house row falls to the anonymous slot - the same dithered field
  // any account with no drawing wears, and never a broken image. The path is still named, but in the
  // slot's tooltip rather than as an <Image> src that the browser would try to fetch and fail.
  assert.match(painted, /sprite-slot/, 'the house row wears the anonymous slot while it has no drawing');
  assert.doesNotMatch(painted, /<img/, 'and draws no image tag for a file that is not there');
  assert.match(painted, /href="\/profile\/debaser-site"/);

  // 6. The log-in form lets a non-address identifier through - the field has to be
  // a text box, or the browser's own e-mail validation stops ADMIN1212 dead.
  const forms = withProviders(element(AccountForms, null));
  const signUpField = forms.slice(forms.indexOf('id="account-signup-email"'), forms.indexOf('id="account-signup-email"') + 140);
  const signInField = forms.slice(forms.indexOf('id="account-signin-email"'), forms.indexOf('id="account-signin-email"') + 140);
  assert.match(signUpField, /type="email"/, 'signing up still asks for an address');
  assert.match(signInField, /type="text"/, 'signing in takes an address or an account name');
  assert.match(forms, /EMAIL ADDRESS OR ACCOUNT NAME:/);
  assert.match(forms, /ADMIN1212/, 'the placeholder names the account to sign in with');
  assert.match(forms, /THE HOUSE ACCOUNT SIGNS IN WITH ITS OWN NAME, NOT AN EMAIL ADDRESS/);

  console.log('site account checks passed');
  console.log('  credential:', 'ADMIN1212 / ADMIN1212', '->', SITE_ACCOUNT_ADDRESS);
  console.log('  byline    :', row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

