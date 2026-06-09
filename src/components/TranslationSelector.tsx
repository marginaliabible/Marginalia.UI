import React from 'react';
import Select, { MultiValue, MultiValueProps, components } from 'react-select';
import type { TranslationSelectOption } from '../App';
import '../styles/MultiSelect.scss';
import { createMultiSelectStyles } from './sharedMultiSelectStyles';

interface TranslationSelectorProps {
  inputId: string;
  options: TranslationSelectOption[];
  value: TranslationSelectOption[];
  onChange: (selected: MultiValue<TranslationSelectOption>) => void | Promise<void>;
  label?: string;
  placeholder?: string;
}

// Custom MultiValue component to show only the ID/value in the tag
const CustomMultiValue = (props: MultiValueProps<TranslationSelectOption, true>) => (
  <components.MultiValue {...props}>
    {props.data.value}
  </components.MultiValue>
);

const TranslationSelector: React.FC<TranslationSelectorProps> = ({
  inputId,
  options,
  value,
  onChange,
  label = 'Translations',
  placeholder = 'Select translations...'
}) => (
  <div className="translation-selector-wrap">
    {label && (
      <label className="form-label fw-semibold small mb-2" htmlFor={inputId}>
        {label}
      </label>
    )}
    <Select
      inputId={inputId}
      isMulti
      options={options}
      value={value}
      onChange={onChange}
      classNamePrefix="translation-select"
      className="translation-selector"
      placeholder={placeholder}
      isSearchable={true}
      closeMenuOnSelect={false}
      isClearable={false}
      noOptionsMessage={() => 'No translations available'}
      components={{ MultiValue: CustomMultiValue }}
      styles={createMultiSelectStyles<TranslationSelectOption>()}
    />
  </div>
);

export default TranslationSelector;
