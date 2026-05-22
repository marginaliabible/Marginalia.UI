import type { GroupBase, StylesConfig } from 'react-select';

export const createMultiSelectStyles = <Option,>(): StylesConfig<Option, true, GroupBase<Option>> => ({
  control: (base) => ({
    ...base,
    minHeight: 'auto',
    backgroundColor: 'var(--bs-body-bg)',
    borderColor: 'var(--bs-border-color)',
    color: 'var(--bs-body-color)',
  }),
  valueContainer: (base) => ({
    ...base,
    flexWrap: 'wrap',
    gap: '0.25rem',
  }),
  multiValue: (base) => ({
    ...base,
    minWidth: 'auto',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--bs-body-color)',
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--bs-secondary-color)',
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--bs-body-color)',
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--bs-body-bg)',
    border: '1px solid var(--bs-border-color)',
  }),
  menuList: (base) => ({
    ...base,
    backgroundColor: 'var(--bs-body-bg)',
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused
      ? 'var(--bs-primary)'
      : state.isSelected
        ? 'var(--bs-primary-bg-subtle)'
        : 'var(--bs-body-bg)',
    color: state.isFocused
      ? 'var(--bs-white)'
      : state.isSelected
        ? 'var(--bs-primary-text-emphasis)'
        : 'var(--bs-body-color)',
    cursor: 'pointer',
  }),
});