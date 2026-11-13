/**
 * GET THIS BOOK (Luke, 2026-11-13): for a book with no free copy, every legal way to get it, under one dropdown on its page:
 * borrow it free, find it in a library, buy it new or second-hand, listen to it, or preview it. Each is a plain outbound
 * link, built from a fixed address on the service's own site and the book's title and author (or its ISBN where one is
 * known), so nothing from a catalogue is ever used as an address. Nothing is fetched, kept or shown from these sites.
 */

export type GetBookLink = { label: string; note: string; href: string };
export type GetBookGroup = { heading: string; links: GetBookLink[] };

type Book = { title: string; author?: string; isbn?: string; work?: string };

const q = (value: string) => encodeURIComponent(value.trim().slice(0, 300));

/** The ways to get a book, grouped, in the order a reader would try them: free first. */
export function getBookLinks(book: Book): GetBookGroup[] {
  const words = [book.title, book.author ?? ''].join(' ').trim();
  const isbn = book.isbn && /^[0-9]{9}[0-9X]$|^[0-9]{13}$/.test(book.isbn) ? book.isbn : undefined;
  const find = isbn ?? words;
  const work = book.work && /^OL[1-9][0-9]{0,11}W$/.test(book.work) ? book.work : undefined;
  return [
    {
      heading: 'BORROW, FREE',
      links: [
        {
          label: 'OPEN LIBRARY',
          note: 'its free lending library, with a free account',
          href: work ? `https://openlibrary.org/works/${work}` : `https://openlibrary.org/search?q=${q(find)}`,
        },
        { label: 'LIBBY / OVERDRIVE', note: "your local library's e-books and audiobooks", href: `https://www.overdrive.com/search?q=${q(words)}` },
        { label: 'INTERNET ARCHIVE', note: 'its lending library of scanned books', href: `https://archive.org/search?query=${q(words)}&and[]=mediatype%3A%22texts%22` },
      ],
    },
    {
      heading: 'FIND IN A LIBRARY',
      links: [
        { label: 'WORLDCAT', note: 'which libraries near you have it', href: `https://search.worldcat.org/search?q=${q(find)}` },
        { label: 'LIBRARY HUB DISCOVER', note: 'UK national, university and specialist libraries', href: `https://discover.libraryhub.jisc.ac.uk/search?q=${q(find)}` },
      ],
    },
    {
      heading: 'BUY',
      links: [
        { label: 'BOOKSHOP.ORG', note: 'new, supporting independent bookshops (US)', href: `https://bookshop.org/search?keywords=${q(find)}` },
        { label: 'BOOKSHOP.ORG UK', note: 'new, supporting independent bookshops (UK)', href: `https://uk.bookshop.org/search?keywords=${q(find)}` },
        { label: 'HIVE', note: 'new, supporting a local bookshop (UK)', href: `https://www.hive.co.uk/Search/Keyword?keyword=${q(find)}` },
        { label: 'ABEBOOKS', note: 'second-hand and rare', href: isbn ? `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}` : `https://www.abebooks.com/servlet/SearchResults?kn=${q(words)}` },
        { label: 'BETTER WORLD BOOKS', note: 'second-hand, funding literacy', href: `https://www.betterworldbooks.com/search/results?q=${q(find)}` },
      ],
    },
    {
      heading: 'LISTEN',
      links: [
        { label: 'LIBRIVOX', note: 'free, read by volunteers, for books out of copyright', href: `https://librivox.org/search?q=${q(book.title)}&search_form=advanced` },
        { label: 'LIBRO.FM', note: 'audiobooks, supporting independent bookshops', href: `https://libro.fm/search?q=${q(words)}` },
      ],
    },
    {
      heading: 'PREVIEW',
      links: [{ label: 'GOOGLE BOOKS', note: 'a look inside, where the publisher allows', href: isbn ? `https://books.google.com/books?vid=ISBN${isbn}` : `https://books.google.com/books?q=${q(words)}` }],
    },
  ];
}
