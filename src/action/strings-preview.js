import ui from 'sketch/ui';
import dom from 'sketch/dom';
import settings from 'sketch/settings';
import { PROJECT_ID, ACCESS_TOKEN_KEY, TEXT_TYPE, SYMBOL_TYPE } from '../constants';
import * as httpUtil from '../util/http';
import * as localStorage from '../util/local-storage';
import * as domUtil from '../util/dom';
import { default as displayTexts } from '../../assets/texts.json';
import { truncateLongText } from '../util/string';

async function stringsPreview(language, wholePage) {
    try {
        if (!language) {
            throw displayTexts.notifications.warning.selectLanguage;
        }
        const selectedDocument = dom.getSelectedDocument();
        if (!selectedDocument) {
            throw displayTexts.notifications.warning.selectDocument;
        }
        const selectedPage = selectedDocument ? selectedDocument.selectedPage : undefined;
        const projectId = settings.documentSettingForKey(selectedDocument, PROJECT_ID);

        if (!selectedPage) {
            throw displayTexts.notifications.warning.selectPage;
        }
        if (selectedDocument.pages === 0) {
            throw displayTexts.notifications.warning.nothingToTranslate;
        }
        if (!settings.settingForKey(ACCESS_TOKEN_KEY)) {
            throw displayTexts.notifications.warning.noAccessToken;
        }
        if (!projectId) {
            throw displayTexts.notifications.warning.selectProject;
        }
        let artboard;
        const translatedPages = localStorage.getListOfTranslatedElements(selectedDocument, 'page');
        if (!!wholePage) {
            if (translatedPages.includes(selectedPage.id)) {
                throw displayTexts.notifications.warning.generatedPageCannotBeTranslated;
            }
        } else {
            artboard = domUtil.getSelectedArtboard(selectedPage);
            if (!artboard) {
                throw displayTexts.notifications.warning.selectArtboard;
            }
            const translatedArtboard = localStorage.getListOfTranslatedElements(selectedDocument, 'artboard');
            if (translatedArtboard.includes(artboard.id) || translatedPages.includes(artboard.parent.id)) {
                throw displayTexts.notifications.warning.generatedArtboardCannotBeTranslated;
            }
        }

        const { stringTranslationsApi, languagesApi, projectsGroupsApi } = httpUtil.createClient();
        let selectedLanguages = [];
        if (language.id < 0) {
            const languages = await languagesApi.withFetchAll().listSupportedLanguages();
            const project = await projectsGroupsApi.getProject(projectId);
            selectedLanguages = languages.data.map(e => e.data).filter(l => project.data.targetLanguageIds.includes(l.id));
        } else {
            selectedLanguages.push(language);
        }
        for (let i = 0; i < selectedLanguages.length; i++) {
            const lang = selectedLanguages[i];
            ui.message(displayTexts.notifications.info.loadingTranslationsForLanguage.replace('%name%', lang.name));
            const res = await stringTranslationsApi.withFetchAll().listLanguageTranslations(projectId, lang.id);
            if (!!wholePage) {
                extractPageTranslations(lang.name, selectedDocument, selectedPage, res.data);
            } else {
                extractArtboardTranslations(lang.name, selectedDocument, selectedPage, artboard, res.data)
            }
        }
    } catch (error) {
        httpUtil.handleError(error);
    }
}


function extractPageTranslations(languageName, document, page, translations) {
    const tags = localStorage.getTags(document);
    localStorage.removeTranslatedElements(document, page.id, languageName, 'page');
    const amountOfTranslatedElements = localStorage.getAmountOfTranslatedElements(document, page.id, languageName, 'page');
    const newPage = page.duplicate();
    localStorage.addTranslatedElement(document, page.id, newPage.id, languageName, 'page');
    newPage.name = `${newPage.name} (${languageName})${amountOfTranslatedElements > 0 ? ` (${amountOfTranslatedElements + 1})` : ''}`;

    const originalStrings = dom.find('Text', page);
    const texts = dom.find('Text', newPage);
    const originalSymbols = dom.find('SymbolInstance', page);
    const symbols = dom.find('SymbolInstance', newPage);
    tags
        .filter(tag => tag.pageId === page.id)
        .forEach(tag => {
            const translation = translations.map(e => e.data).find(e => e.stringId === tag.stringId);
            if (!translation) {
                return;
            }
            const translationText = translation.text || (translation.plurals || []).map(e => e.text).find(e => !!e);
            if (!translationText) {
                return;
            }
            if (tag.type === TEXT_TYPE) {
                const index = originalStrings.findIndex(e => e.id === tag.id);
                if (index >= 0) {
                    texts[index].text = translationText;
                }
            } else if (tag.type === SYMBOL_TYPE) {
                for (let i = 0; i < originalSymbols.length; i++) {
                    const originalSymbol = originalSymbols[i];
                    for (let j = 0; j < originalSymbol.overrides.length; j++) {
                        const override = originalSymbol.overrides[j];
                        if (originalSymbol.id + '/' + override.id === tag.id) {
                            symbols[i].overrides[j].value = translationText;
                            return;
                        }
                    }
                }
            }
        });

    domUtil.removeGeneratedArtboards(document, page, newPage);
    document.selectedPage = newPage;
    ui.message(displayTexts.notifications.info.translatedPageCreated.replace('%name%', truncateLongText(newPage.name)));

}

function extractArtboardTranslations(languageName, document, page, artboard, translations) {
    const tags = localStorage.getTags(document);
    localStorage.removeTranslatedElements(document, artboard.id, languageName, 'artboard');
    const amountOfTranslatedElements = localStorage.getAmountOfTranslatedElements(document, artboard.id, languageName, 'artboard');
    const newArtboard = artboard.duplicate();
    localStorage.addTranslatedElement(document, artboard.id, newArtboard.id, languageName, 'artboard');
    newArtboard.name = `${newArtboard.name} (${languageName})${amountOfTranslatedElements > 0 ? ` (${amountOfTranslatedElements + 1})` : ''}`;
    newArtboard.selected = true;
    artboard.selected = false;
    //by default duplicate will appear in the same place as original
    domUtil.offsetArtboard(page, newArtboard);

    const originalStrings = dom.find('Text', artboard);
    const texts = dom.find('Text', newArtboard);
    const originalSymbols = dom.find('SymbolInstance', artboard);
    const symbols = dom.find('SymbolInstance', newArtboard);
    tags
        .filter(tag => tag.pageId === page.id)
        .filter(tag => tag.artboardId === artboard.id)
        .forEach(tag => {
            const translation = translations.map(e => e.data).find(e => e.stringId === tag.stringId);
            if (!translation) {
                return;
            }
            const translationText = translation.text || (translation.plurals || []).map(e => e.text).find(e => !!e);
            if (!translationText) {
                return;
            }
            if (tag.type === TEXT_TYPE) {
                const index = originalStrings.findIndex(e => e.id === tag.id);
                if (index >= 0) {
                    texts[index].text = translationText;
                }
            } else if (tag.type === SYMBOL_TYPE) {
                for (let i = 0; i < originalSymbols.length; i++) {
                    const originalSymbol = originalSymbols[i];
                    for (let j = 0; j < originalSymbol.overrides.length; j++) {
                        const override = originalSymbol.overrides[j];
                        if (originalSymbol.id + '/' + override.id === tag.id) {
                            symbols[i].overrides[j].value = translationText;
                            return;
                        }
                    }
                }
            }
        });

    ui.message(displayTexts.notifications.info.translatedArtboardCreated.replace('%name%', truncateLongText(newArtboard.name)));
}

export { stringsPreview };