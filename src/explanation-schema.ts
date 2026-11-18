/** Shape constraints supplement, and never replace, the chess evidence validator. */
export const EXPLANATION_SCHEMA = {
    type:'object', additionalProperties:false,
    properties:{
        leadFactId:{type:'string',maxLength:120}, supportFactId:{type:'string',maxLength:120}, replyFactId:{type:'string',maxLength:120},
        toneVariant:{type:'string',enum:['direct','encouraging','gentle']},
        evidenceStepIds:{type:'array',items:{type:'integer',minimum:0},minItems:1,maxItems:10,uniqueItems:true},
    }, required:['leadFactId','toneVariant'],
};
