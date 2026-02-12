import type { SearchQuery, SearchResult } from "@isomorphiq/tasks/types";
interface AdvancedSearchProps {
    onSearch: (query: SearchQuery) => void;
    searchResult?: SearchResult;
    isLoading?: boolean;
}
export declare function AdvancedSearch({ onSearch, searchResult, isLoading }: AdvancedSearchProps): import("react/jsx-runtime").JSX.Element;
export {};
