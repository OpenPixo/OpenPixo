import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import type { ModelCapabilityTag } from '../modelCapabilityTags';

const ONBOARDING_DROPDOWN_OPEN_EVENT = 'pixo:onboarding-dropdown-open';

type OnboardingDropdownOption = {
  value: string;
  label: string;
  tag?: string;
  tagKind?: ModelCapabilityTag;
  meta?: string;
};

type OnboardingDropdownBaseProps = {
  label: string;
  placeholder: string;
  options: OnboardingDropdownOption[];
  placement?: 'bottom' | 'top';
  searchable?: boolean;
  searchPlaceholder?: string;
  sourceTone?: string;
  allowEmptyValue?: boolean;
  /**
   * When true (and not multi-select), a typed search query that doesn't match
   * any existing option is offered as a selectable "Use '<query>'" entry, so
   * users can pick a value that isn't in the suggested list (e.g. a locally
   * installed Ollama model).
   */
  allowCustomValue?: boolean;
};

type OnboardingDropdownProps =
  | (OnboardingDropdownBaseProps & {
      value: string;
      onChange: (value: string) => void;
      multiple?: false;
    })
  | (OnboardingDropdownBaseProps & {
      value: string[];
      onChange: (value: string[]) => void;
      multiple: true;
    });

export function OnboardingDropdown(props: OnboardingDropdownProps) {
  const t = useT();
  const {
    label,
    placeholder,
    value,
    options,
    placement = 'bottom',
    multiple = false,
    searchable = false,
    searchPlaceholder,
    sourceTone,
    allowEmptyValue = false,
    allowCustomValue = false,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [resolvedPlacement, setResolvedPlacement] = useState(placement);
  const [menuMaxHeight, setMenuMaxHeight] = useState(240);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dropdownIdRef = useRef(`onboarding-dropdown-${Math.random().toString(36).slice(2)}`);
  const selectedValues = Array.isArray(value)
    ? value
    : value || allowEmptyValue
      ? [value]
      : [];
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value));
  const selectedOption = selectedOptions[0];
  const hasValue = selectedOptions.length > 0;
  const selectedLabel = multiple
    ? selectedOptions.map((option) => option.label).join(', ')
    : selectedOption?.label;
  const selectedTag = multiple ? undefined : selectedOption?.tag;
  const selectedTagKind = multiple ? undefined : selectedOption?.tagKind;
  const selectedTagDescriptionId = selectedTag
    ? `${dropdownIdRef.current}-selected-tag`
    : undefined;
  const triggerLabel = selectedLabel || placeholder;
  const normalizedQuery = query.trim().toLowerCase();
  const trimmedQuery = query.trim();
  const filteredOptions =
    searchable && normalizedQuery
      ? options.filter((option) =>
          `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery),
        )
      : options;
  const canUseCustomValue =
    allowCustomValue &&
    !multiple &&
    trimmedQuery.length > 0 &&
    !options.some((option) => option.value.toLowerCase() === normalizedQuery);
  const visibleOptions = canUseCustomValue
    ? [
        ...filteredOptions,
        {
          value: trimmedQuery,
          label: t('settings.onboardingModelUseCustom', { query: trimmedQuery }),
        },
      ]
    : filteredOptions;
  const emptyMessage = searchable ? t('homeHero.footer.noMatches') : t('settings.fetchModelsEmpty');

  useLayoutEffect(() => {
    if (!open) return;

    function measureMenu() {
      const root = rootRef.current;
      if (!root) return;

      const rect = root.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const nextPlacement =
        placement === 'top' || (spaceBelow < 260 && spaceAbove > spaceBelow)
          ? 'top'
          : 'bottom';
      const availableSpace = nextPlacement === 'top' ? spaceAbove : spaceBelow;
      setResolvedPlacement(nextPlacement);
      setMenuMaxHeight(Math.max(48, Math.min(240, availableSpace - 16)));
    }

    measureMenu();
    window.addEventListener('resize', measureMenu);
    window.addEventListener('scroll', measureMenu, true);
    return () => {
      window.removeEventListener('resize', measureMenu);
      window.removeEventListener('scroll', measureMenu, true);
    };
  }, [open, placement, options.length]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    function handlePeerOpen(event: Event) {
      if ((event as CustomEvent<string>).detail !== dropdownIdRef.current) {
        setOpen(false);
      }
    }

    window.addEventListener(ONBOARDING_DROPDOWN_OPEN_EVENT, handlePeerOpen);
    return () => {
      window.removeEventListener(ONBOARDING_DROPDOWN_OPEN_EVENT, handlePeerOpen);
    };
  }, []);

  function toggleOpen() {
    setOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        window.dispatchEvent(
          new CustomEvent(ONBOARDING_DROPDOWN_OPEN_EVENT, {
            detail: dropdownIdRef.current,
          }),
        );
      }
      return nextOpen;
    });
  }

  return (
    <div
      className="onboarding-view__select-field"
      data-placement={resolvedPlacement}
      data-open={open || undefined}
      ref={rootRef}
    >
      <span
        className="onboarding-view__select-label"
        data-source-tone={sourceTone || undefined}
      >
        {label}
      </span>
      <button
        type="button"
        className={`onboarding-view__select-trigger${open ? ' is-open' : ''}${
          hasValue ? ' has-value' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel}
        aria-describedby={selectedTagDescriptionId}
        title={triggerLabel}
        onClick={toggleOpen}
      >
        <span className="onboarding-view__select-trigger-value">
          <span>{triggerLabel}</span>
          {selectedTag ? (
            <span
              className="onboarding-view__select-badge"
              data-tag={selectedTagKind}
              id={selectedTagDescriptionId}
            >
              {selectedTag}
            </span>
          ) : null}
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open ? (
        <div
          className="onboarding-view__select-menu"
          data-searchable={searchable || undefined}
          style={{ '--onboarding-select-menu-max-height': `${menuMaxHeight}px` } as CSSProperties}
        >
          {searchable ? (
            <label
              className="onboarding-view__select-search"
              onClick={(event) => event.stopPropagation()}
            >
              <Icon name="search" size={14} />
              <input
                type="search"
                value={query}
                placeholder={searchPlaceholder || placeholder}
                aria-label={searchPlaceholder || label}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') {
                    event.stopPropagation();
                  }
                }}
              />
            </label>
          ) : null}
          <div
            className="onboarding-view__select-options"
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
          >
            {visibleOptions.map((option, index) => {
              const selected = selectedValues.includes(option.value);
              const optionId = `${dropdownIdRef.current}-option-${index}`;
              const optionLabelId = `${optionId}-label`;
              const optionMetaId = option.meta ? `${optionId}-meta` : undefined;
              const optionTagId = option.tag ? `${optionId}-tag` : undefined;
              const optionDescriptionIds = [optionMetaId, optionTagId]
                .filter(Boolean)
                .join(' ') || undefined;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`onboarding-view__select-option${selected ? ' is-selected' : ''}`}
                  role="option"
                  aria-selected={selected}
                  aria-labelledby={optionLabelId}
                  aria-describedby={optionDescriptionIds}
                  onClick={() => {
                    if (props.multiple) {
                      props.onChange(
                        selected
                          ? selectedValues.filter((selectedValue) => selectedValue !== option.value)
                          : [...selectedValues, option.value],
                      );
                      return;
                    }
                    props.onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="onboarding-view__select-option-content">
                    <span className="onboarding-view__select-option-copy">
                      <span id={optionLabelId}>{option.label}</span>
                      {option.meta ? (
                        <span
                          className="onboarding-view__select-option-meta"
                          id={optionMetaId}
                        >
                          {option.meta}
                        </span>
                      ) : null}
                    </span>
                    {option.tag ? (
                      <span
                        className="onboarding-view__select-badge"
                        data-tag={option.tagKind}
                        id={optionTagId}
                      >
                        {option.tag}
                      </span>
                    ) : null}
                  </span>
                  {selected ? <Icon name="check" size={15} /> : null}
                </button>
              );
            })}
            {visibleOptions.length === 0 ? (
              <div className="onboarding-view__select-empty">{emptyMessage}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
