import type { SearchResult, Task } from "@isomorphiq/tasks/types";
interface SearchResultsProps {
    searchResult: SearchResult;
    isLoading?: boolean;
    onTaskClick?: (task: Task) => void;
}
export declare function SearchResults({ searchResult, isLoading, onTaskClick }: SearchResultsProps): import("react/jsx-runtime").JSX.Element;
export {};
