import React from 'react';
import Select, { MultiValue } from 'react-select';
import '../styles/MultiSelect.scss';
import { createMultiSelectStyles } from './sharedMultiSelectStyles';

interface LanguageOption {
  code: string;
  count: number;
}

interface SelectOption {
  value: string;
  label: string;
  count: number;
}

interface LanguageTagSelectorProps {
  languageOptions: LanguageOption[];
  selectedLanguages: string[];
  onChange: (selected: string[]) => void;
  getLanguageDisplayName: (code: string) => string;
}

const LanguageTagSelector: React.FC<LanguageTagSelectorProps> = ({
  languageOptions,
  selectedLanguages,
  onChange,
  getLanguageDisplayName,
}) => {
  // Convert languageOptions to react-select format
  const options: SelectOption[] = languageOptions.map((lang) => ({
    value: lang.code,
    label: `${getLanguageDisplayName(lang.code)} (${lang.count})`,
    count: lang.count,
  }));

  // Convert selectedLanguages to react-select format
  const selectedOptions: SelectOption[] = selectedLanguages
    .map((code) => {
      const lang = languageOptions.find((l) => l.code === code);
      return lang
        ? {
            value: code,
            label: `${getLanguageDisplayName(code)} (${lang.count})`,
            count: lang.count,
          }
        : null;
    })
    .filter((opt): opt is SelectOption => opt !== null);

  const handleChange = (selected: MultiValue<SelectOption>) => {
    const codes = selected.map((opt) => opt.value);
    onChange(codes);
  };

  // Custom option label with count
  const formatOptionLabel = (option: SelectOption) => (
    <div className="d-flex justify-content-between align-items-center w-100">
      <span>{getLanguageDisplayName(option.value)}</span>
      <span className="ms-2 small text-body-secondary">({option.count})</span>
    </div>
  );

  return (
    <Select
      isMulti
      options={options}
      value={selectedOptions}
      onChange={handleChange}
      placeholder="Select languages..."
      classNamePrefix="language-select"
      className="language-tag-selector"
      formatOptionLabel={formatOptionLabel}
      isClearable={false}
      isSearchable={true}
      closeMenuOnSelect={false}
      aria-label="Language selection"
      inputId="languageTagSelector"
      styles={createMultiSelectStyles<SelectOption>()}
    />
  );
};

export default LanguageTagSelector;
