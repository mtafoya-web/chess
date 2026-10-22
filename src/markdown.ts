// Deliberately small Markdown subset. Raw HTML, links and images stay inert text.
export function renderMarkdown(target: HTMLElement, value: string) {
    const fragment = document.createDocumentFragment();
    const pattern = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\*([^*\n]+)\*)/g;
    let start = 0;
    for (const match of value.matchAll(pattern)) {
        fragment.append(document.createTextNode(value.slice(start, match.index)));
        const element = document.createElement(match[2] ? 'strong' : match[3] ? 'code' : 'em');
        element.textContent = match[2] ?? match[3] ?? match[4]; fragment.append(element);
        start = match.index! + match[0].length;
    }
    fragment.append(document.createTextNode(value.slice(start))); target.replaceChildren(fragment);
}
