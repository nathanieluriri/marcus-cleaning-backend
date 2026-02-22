
from pymongo import ReturnDocument
from core.database import db
from fastapi import HTTPException,status
from typing import List,Optional
from schemas.customer_schema import CustomerUpdate, CustomerCreate, CustomerOut

async def create_user(user_data: CustomerCreate) -> CustomerOut:
    user_dict = user_data.model_dump()
    result =await db.customers.insert_one(user_dict)
    result = await db.customers.find_one(filter={"_id":result.inserted_id})
  
    returnable_result = CustomerOut(**result)
    return returnable_result

async def get_user(filter_dict: dict) -> Optional[CustomerOut]:
    try:
        result = await db.customers.find_one(filter_dict)

        if result is None:
            return None

        return CustomerOut(**result)

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while fetching customer: {str(e)}"
        )
    
async def get_users(filter_dict: dict = {},start=0,stop=100) -> List[CustomerOut]:
    try:
        if filter_dict is None:
            filter_dict = {}

        cursor = (db.customers.find(filter_dict)
        .skip(start)
        .limit(stop - start)
        )
        user_list = []

        async for doc in cursor:
            userObj =CustomerOut(**doc)
            userObj.password=None
            user_list.append(userObj)
        
        return user_list

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while fetching customers: {str(e)}"
        )
async def update_user(filter_dict: dict, user_data: CustomerUpdate) -> CustomerOut:
    result = await db.customers.find_one_and_update(
        filter_dict,
        {"$set": user_data.model_dump()},
        return_document=ReturnDocument.AFTER
    )
    returnable_result = CustomerOut(**result)
    return returnable_result

async def delete_user(filter_dict: dict):
    return await db.customers.delete_one(filter_dict)