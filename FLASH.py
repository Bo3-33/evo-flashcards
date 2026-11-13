from ti_system import disp_at, disp_clr, wait_key

UP, LEFT, RIGHT, DOWN = 25, 24, 26, 34
ENTER, CLEAR = 105, 45
WIDTH, LINES = 25, 7


def valid_name(name):
    if not isinstance(name, str) or not 1 <= len(name) <= 8:
        return False
    if name in ("FLASH", "FLINDEX") or not "A" <= name[0] <= "Z":
        return False
    for ch in name:
        if not ("A" <= ch <= "Z" or "0" <= ch <= "9"):
            return False
    return True


def show(title, lines, footer):
    disp_clr()
    disp_at(1, title, "left")
    for index in range(len(lines)):
        disp_at(index + 3, lines[index], "left")
    disp_at(11, footer, "left")


def notice(title, lines):
    show(title, lines, "ENTER / CLEAR to return")
    while wait_key() not in (ENTER, CLEAR):
        pass


def wrapped(text):
    lines = []
    for paragraph in text.split("\n"):
        while len(paragraph) > WIDTH:
            cut = paragraph.rfind(" ", 0, WIDTH + 1)
            if cut <= 0:
                cut = WIDTH
            lines.append(paragraph[:cut])
            paragraph = paragraph[cut:].lstrip(" ")
        lines.append(paragraph)
    return lines


def study(cards):
    card, side, page = 0, 0, 0
    while True:
        lines = wrapped(cards[card][side])
        pages = (len(lines) - 1) // LINES + 1
        start = page * LINES
        title = str(card + 1) + "/" + str(len(cards))
        title += " " + ("Back" if side else "Front")
        if pages > 1:
            title += "  " + str(page + 1) + "/" + str(pages)
        show(title, lines[start:start + LINES], "ENTER Flip   CLEAR Decks")
        key = wait_key()
        if key == CLEAR:
            return
        if key == ENTER:
            side, page = 1 - side, 0
        elif key == LEFT and card > 0:
            card, side, page = card - 1, 0, 0
        elif key == RIGHT and card + 1 < len(cards):
            card, side, page = card + 1, 0, 0
        elif key == UP and page > 0:
            page -= 1
        elif key == DOWN and page + 1 < pages:
            page += 1


def open_deck(name):
    if not valid_name(name):
        notice("Invalid deck name", ["Use 1 to 8 letters or", "digits. Start with a", "letter."])
        return
    try:
        cards = __import__(name).CARDS
        if not isinstance(cards, tuple) or not cards:
            raise ValueError()
        for pair in cards:
            if (not isinstance(pair, tuple) or len(pair) != 2
                    or not isinstance(pair[0], str) or not isinstance(pair[1], str)):
                raise ValueError()
    except ImportError:
        notice("Deck unavailable", [name + " is missing.", "Send it to RAM again."])
        return
    except MemoryError:
        notice("Deck too large", ["Split the CSV into", "smaller decks."])
        return
    except (AttributeError, ValueError, SyntaxError):
        notice("Invalid deck", ["Send " + name + " again."])
        return
    study(cards)


def main():
    names = []
    try:
        from FLINDEX import DECKS
        for name in DECKS:
            if valid_name(name) and name not in names:
                names.append(name)
    except (ImportError, SyntaxError, TypeError):
        pass
    names.sort()
    choices = names + ["Open by name"]
    selected = 0
    while True:
        first = max(0, selected - LINES + 1)
        lines = []
        for index in range(first, min(len(choices), first + LINES)):
            marker = "> " if index == selected else "  "
            lines.append(marker + choices[index])
        if not names:
            lines = ["Send a CSV from the", "website to add a deck.", ""] + lines
        show("Flashcards", lines, "ENTER Open   CLEAR Exit")
        key = wait_key()
        if key == CLEAR:
            disp_clr()
            return
        if key == UP and selected > 0:
            selected -= 1
        elif key == DOWN and selected + 1 < len(choices):
            selected += 1
        elif key == ENTER:
            if selected < len(names):
                open_deck(names[selected])
            else:
                disp_clr()
                name = input("Deck name: ").strip().upper()
                if name:
                    open_deck(name)


main()
