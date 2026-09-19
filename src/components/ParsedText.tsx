import {useState} from "react";
import {Textarea, type TextareaProps, TextInput, type TextInputProps} from "@mantine/core";

/** Text as the user typed it, over a value that parses from it.
 *
 *  A field controlled by the parsed value rewrote what was being typed on
 *  every keystroke: "0." came back as "0", so a decimal could only be pasted; a
 *  trailing comma or a new line was filtered away before the next character
 *  could follow it; and a half-typed number was committed as zero. The text is
 *  kept as typed instead, and the value committed only when the text parses --
 *  `parse` returns null for text that is not a value yet. The draft gives way to
 *  the value when the value changes from somewhere else: an import, a reset,
 *  another control.
 */
function useDraft<T>(value: T, format: (value: T) => string, parse: (text: string) => T | null) {
    const shown = format(value);
    const [draft, setDraft] = useState(shown);
    const [lastShown, setLastShown] = useState(shown);
    if (shown !== lastShown) {
        // Adjusted while rendering, React's pattern for state that follows a
        // prop: an edit this field made reads back to the same text and keeps
        // the draft; any other change replaces it.
        setLastShown(shown);
        const drafted = parse(draft);
        if (drafted === null || format(drafted) !== shown) setDraft(shown);
    }
    const edit = (text: string, commit: (value: T) => void) => {
        setDraft(text);
        const parsed = parse(text);
        if (parsed !== null) commit(parsed);
    };
    return [draft, edit] as const;
}

interface ParsedProps<T> {
    value: T;
    format: (value: T) => string;
    parse: (text: string) => T | null;
    onValue: (value: T) => void;
}

export const ParsedTextInput = <T,>({value, format, parse, onValue, ...rest}: ParsedProps<T> & Omit<TextInputProps, "value" | "onChange">) => {
    const [draft, edit] = useDraft(value, format, parse);
    return <TextInput {...rest} value={draft} onChange={event => edit(event.currentTarget.value, onValue)} />;
};

export const ParsedTextarea = <T,>({value, format, parse, onValue, ...rest}: ParsedProps<T> & Omit<TextareaProps, "value" | "onChange">) => {
    const [draft, edit] = useDraft(value, format, parse);
    return <Textarea {...rest} value={draft} onChange={event => edit(event.currentTarget.value, onValue)} />;
};
